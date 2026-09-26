// ==============================================================================================
// [S1.128 / khoản 15] NGUỒN KHOÁ CÔNG KHAI — KIỂU TỐI THIỂU MÀ TÀI LIỆU CÔNG BỐ CẦN
//
// Hai thứ, và chỉ hai: `kid` đang dùng, và nửa công khai (SPKI DER) theo `kid`. `publicKeys()` có
// ĐÚNG hình dạng của `ReceiptSigningKeyRing.publicKeys()` nên vòng khoá thoả kiểu này mà không
// cần bọc; nguồn KMS (`nguon-kms.ts`) là một ảnh chụp cùng hình dạng. `ReadonlyMap` chứ không
// `Iterable`: một `kid` hai lần là điều kiểu này KHÔNG diễn đạt được.
// ==============================================================================================

export interface NguonKhoaCongKhai {
  readonly activeKeyId: string;
  publicKeys(): ReadonlyMap<string, Uint8Array>;
}

/** Lỗi dựng nguồn khoá hay tài liệu công bố. Thông điệp nêu `kid` (nhãn công khai), không nêu `keyId`. */
export class NguonKhoaError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NguonKhoaError";
  }
}
