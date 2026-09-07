// ==============================================================================================
// BỘ KÝ MỐC NEO DÙNG TRONG TEST — VÀ VÌ SAO NÓ *KHÔNG* GỌI `anchor-sign.ts`
//
// [S1.17] Bộ ký thật nằm ở `packages/audit/src/anchor-sign.ts`, sau quy tắc
// `g11-ky-neo-chi-o-cong-cu-xuat-neo`. File này ký bằng `node:crypto` TRỰC TIẾP, và đó là một
// quyết định chứ không phải một cách lách quy tắc:
//
//   ⑴ Nếu fixture gọi chính bộ ký của sản phẩm thì `verifyAnchorRecord` chỉ được đo là NGHỊCH ĐẢO
//      CỦA CHÍNH BỘ KÝ ẤY. Hai bên sai cùng một kiểu — sai thứ tự trường, sai encoding, sai băm —
//      thì mọi test vẫn xanh. Ký ở đây bằng một đường độc lập biến mỗi lần kiểm chữ ký thành một
//      phép đối chiếu HAI CÀI ĐẶT, đúng khuôn `verifyReceipt` đã dùng với `createVerify` của
//      `node:crypto` ở S1.5.
//   ⑵ `createSign("sha256")` + khoá PKCS8 DER là ĐÚNG con đường mà `openssl dgst -sha256 -sign`
//      đi. Một kiểm toán viên cầm artefact và chạy `openssl` phải ra cùng kết quả; file này là
//      chỗ gần nhất với phép đo đó mà bộ test tự chạy được.
//
// Đổi lại, file này KHÔNG đo hàng rào môi trường fail-closed của bộ ký sản phẩm
// (`assertLocalDevAllowed`) — thứ đó do `packages/audit/src/anchor-sign.test.ts` đo, và nó là
// file DUY NHẤT ngoài `tools/neo-so-kiem-toan` được phép chạm bộ ký ấy.
// ==============================================================================================

import { createSign, generateKeyPairSync } from "node:crypto";
import { buildAnchorText, type AnchorFields, type SignedAnchorRecord } from "@trustprocure/audit";

export interface BoKyNeoThuNghiem {
  readonly kid: string;
  /** Vòng khoá CÔNG KHAI để đưa cho `verifyAnchorRecord` / `loadVerifiedAnchors`. */
  readonly khoaCongKhai: ReadonlyMap<string, Uint8Array>;
  /** Ký một mốc neo đúng dạng chính tắc. */
  ky(fields: Omit<AnchorFields, "kid">): SignedAnchorRecord;
  /** Ký một chuỗi byte TUỲ Ý — dùng cho các ca "chữ ký hợp lệ mà văn bản thì không". */
  kyVanBan(text: string): SignedAnchorRecord;
}

/**
 * Dựng một bộ ký mốc neo với một cặp khoá P-256 mới sinh.
 *
 * Mỗi lời gọi cho một cặp khoá KHÁC — nên hai bộ ký trong cùng một test là hai gốc tin cậy khác
 * nhau, và đó là cách viết ca "mốc neo ký bằng khoá mà kiểm toán viên không tin".
 */
export function taoBoKyNeoThuNghiem(kid = "neo-test"): BoKyNeoThuNghiem {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    privateKeyEncoding: { type: "pkcs8", format: "der" },
    publicKeyEncoding: { type: "spki", format: "der" },
  });

  function kyVanBan(text: string): SignedAnchorRecord {
    const sig = createSign("sha256")
      .update(text, "utf8")
      .sign({ key: privateKey, format: "der", type: "pkcs8" });
    return { text, sig: sig.toString("base64") };
  }

  return {
    kid,
    khoaCongKhai: new Map([[kid, publicKey]]),
    ky: (fields) => kyVanBan(buildAnchorText({ ...fields, kid })),
    kyVanBan,
  };
}
