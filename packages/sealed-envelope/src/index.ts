// ============================================================================================
// MẶT TIỀN CÔNG KHAI CỦA @trustprocure/sealed-envelope — CỬA NIÊM PHONG, AN TOÀN CHO MỌI SERVICE
//
// Cùng khuôn `@trustprocure/crypto-keys`: gói này có HAI cửa, và chỉ một cửa nằm ở đây.
//   * `index.ts` (file này) — niêm phong, vòng đời khoá, đọc phần đầu phong bì. Không có một
//     đường nào từ đây tới bản rõ của một báo giá.
//   * `unseal.ts` — MỞ phong bì. Canh bởi `g8-khong-mo-phong-bi-ngoai-unseal-worker`, đúng một
//     miễn trừ: `apps/unseal-worker/`.
//
// Bất biến có tên đang được giữ ở cửa này, và nó là lý do danh sách dưới đây ngắn hơn danh sách
// symbol thật sự tồn tại trong gói: **không symbol nào ở đây nhận hay trả một khoá riêng.**
// `issueRfqKeyPair` sinh ra một khoá riêng và trả về mọi thứ TRỪ nó (ADR-019 mục 1); `sealBid`
// chỉ biết khoá công khai; `describeEnvelope` không cần khoá nào. `decodeEnvelope`,
// `deriveContentKey`, `importPrivateKey` KHÔNG ở đây — chúng là công cụ của đường mở.
// ============================================================================================
export {
  KEY_AGREEMENT_ALGORITHMS,
  SEALED_ENVELOPE_FORMAT_VERSION,
  SealedEnvelopeError,
  describeEnvelope,
  type KeyAgreementAlgorithm,
  type SealedEnvelopeHeader,
} from "./format.js";
export { chooseKeyAgreementAlgorithm, sealBid, type SealBidInput } from "./seal.js";
export {
  DEFAULT_KEY_AGREEMENT_ALGORITHM,
  getRfqPublicKeys,
  issueRfqKeyPair,
  revokeRfqKeyMaterial,
  type IssueRfqKeyPairInput,
  type RevokeRfqKeyMaterialInput,
  type RfqPublicKeyRecord,
} from "./key-material.js";
// Chuyển tiếp KIỂU của bộ bọc khoá, không chuyển tiếp một cài đặt nào. Nhờ dòng này,
// `packages/rfq` khai được tham số `keyWrapper` mà KHÔNG cần một cạnh phụ thuộc nào tới
// `@trustprocure/crypto-keys` — một gói ít cạnh tới crypto-keys hơn là một gói ít đường tới
// khoá hơn. Đây là `export type`, nên nó không tồn tại lúc chạy và không xuất hiện ở danh sách
// trắng barrel.
export type { KeyWrapper } from "@trustprocure/crypto-keys";
