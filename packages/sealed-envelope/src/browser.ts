// ==============================================================================================
// CỬA THỨ BA CỦA @trustprocure/sealed-envelope — CỬA TRÌNH DUYỆT
//
// Gói này tới hôm nay có HAI cửa, và lý do của chúng nằm ở đầu `index.ts`:
//   * `index.ts`  — niêm phong + vòng đời khoá, an toàn cho mọi service máy chủ;
//   * `unseal.ts` — MỞ phong bì, canh bởi `g8-...`, đúng một miễn trừ `apps/unseal-worker/`.
//
// File này là cửa thứ BA, và nó tồn tại vì một lý do đo được: **`index.ts` không nạp được vào
// trình duyệt.** Nó re-export `key-material.js`, mà file ấy nhận một `pg.ClientBase` — kéo theo
// `pg` và `node:*` vào một trang web. Một nhà cung cấp mở trang nộp thầu sẽ tải về một bộ driver
// CSDL, và trang sẽ hỏng ngay ở lời `import` đầu tiên.
//
// CỬA NÀY KHAI GÌ, VÀ VÌ SAO DANH SÁCH NGẮN ĐÚNG NHƯ THẾ
//
// Đúng những symbol mà một trình duyệt CẦN để niêm phong một báo giá, không hơn một cái:
//   * `sealBid` cùng kiểu vào của nó — việc duy nhất trang web làm với mật mã;
//   * `chooseKeyAgreementAlgorithm` — chọn thuật toán theo thứ trình duyệt THẬT SỰ có
//     (ADR-011 mục 1: P-256 mặc định, X25519 cơ hội, chọn LÚC CHẠY);
//   * `describeEnvelope` + hằng định dạng — để trang tự đọc lại phong bì nó vừa tạo và cho người
//     dùng thấy nó là một phong bì thật, không phải một lời hứa.
//
// KHÔNG có `issueRfqKeyPair`, KHÔNG có `revokeRfqKeyMaterial`, KHÔNG có `getRfqPublicKeys`: cả ba
// nhận một kết nối CSDL. KHÔNG có một đường nào tới bản rõ của một báo giá khác — cửa mở nằm ở
// `unseal.ts` và nó không đi qua đây.
//
// PHÉP ĐO GIỮ CỬA NÀY ĐÚNG
//
// `packages/sealed-envelope/src/cua-trinh-duyet.test.ts` đọc cây import BẮC CẦU từ file này và
// đòi: không file nào trong cây import `pg`, `node:*` dạng giá trị, hay một gói workspace khác.
// Nó đọc cây THẬT bằng `ts.createSourceFile`, không đọc một danh sách tên — nên thêm một import
// máy chủ vào `seal.ts` hay `format.ts` làm nó ĐỎ, kể cả khi không ai nhớ tới file này.
// ==============================================================================================

export {
  KEY_AGREEMENT_ALGORITHMS,
  SEALED_ENVELOPE_FORMAT_VERSION,
  SealedEnvelopeError,
  describeEnvelope,
  type KeyAgreementAlgorithm,
  type SealedEnvelopeHeader,
} from "./format.js";
export { chooseKeyAgreementAlgorithm, sealBid, type SealBidInput } from "./seal.js";
