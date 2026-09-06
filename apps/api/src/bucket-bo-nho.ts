// ==============================================================================================
// apps/api/src/bucket-bo-nho.ts — BUCKET HẠN MỨC TRONG BỘ NHỚ cho lời gọi mà CSDL không đếm được
// (sổ nợ 52 / review H4-5)
//
// Bucket `LOGIN_CALLER` (038) sống ở `otp_rate_limits` và mang khoá ngoại tới `organizations`: một
// lời gọi khai `orgId` KHÔNG TỒN TẠI không đếm được ở đó (23503). Trước nợ 52, lời gọi ấy đi tiếp
// không trần — hai giao dịch lỗi mỗi lần, và 429 chỉ dành cho tổ chức thật (oracle tồn tại, H4-5).
// Bucket này đếm ĐÚNG ca ấy, theo `route|người gọi`, cửa sổ trượt cố định, trong tiến trình.
//
// Giới hạn, nói ra: (1) theo TIẾN TRÌNH — nhiều instance thì mỗi instance một bộ đếm (cùng giới hạn
// với runner outbox, ADR-022); (2) mất khi tiến trình khởi động lại; (3) có TRẦN KÍCH THƯỚC và khi
// đầy thì FAIL-CLOSED: khoá mới nhận "đã vượt" thay vì làm đầy bộ nhớ — kẻ xoay địa chỉ để làm đầy
// bảng chỉ tự khoá mình và những người gọi tổ chức lạ khác, không khoá được tổ chức thật (bucket
// CSDL). Nó cố ý KHÔNG thay bucket CSDL cho tổ chức thật — chỉ bịt cái lỗ "tổ chức lạ".
// ==============================================================================================

export interface TuyChonBucketBoNho {
  /** Cửa sổ, ms. */
  readonly cuaSoMs: number;
  /** Số khoá tối đa giữ trong bộ nhớ; vượt ⇒ dọn khoá hết hạn, vẫn vượt ⇒ fail-closed. */
  readonly toiDaKhoa?: number;
  /** Đồng hồ — tiêm để test không phải chờ thật. */
  readonly bayGio?: () => number;
}

export const BUCKET_BO_NHO_TOI_DA_MAC_DINH = 50_000;

export class BucketBoNho {
  readonly #so = new Map<string, { n: number; het: number }>();
  readonly #cuaSoMs: number;
  readonly #toiDa: number;
  readonly #bayGio: () => number;

  constructor(tuyChon: TuyChonBucketBoNho) {
    if (!Number.isFinite(tuyChon.cuaSoMs) || tuyChon.cuaSoMs <= 0) throw new RangeError("cuaSoMs phải > 0");
    this.#cuaSoMs = tuyChon.cuaSoMs;
    this.#toiDa = tuyChon.toiDaKhoa ?? BUCKET_BO_NHO_TOI_DA_MAC_DINH;
    if (!Number.isInteger(this.#toiDa) || this.#toiDa < 1) throw new RangeError("toiDaKhoa phải là số nguyên ≥ 1");
    this.#bayGio = tuyChon.bayGio ?? Date.now;
  }

  /** Tăng và trả về số lần trong cửa sổ hiện tại (cửa sổ mới ⇒ 1). Đầy ⇒ `Number.POSITIVE_INFINITY`. */
  tang(khoa: string): number {
    const luc = this.#bayGio();
    const h = this.#so.get(khoa);
    if (h !== undefined && h.het > luc) {
      h.n += 1;
      return h.n;
    }
    if (h !== undefined) this.#so.delete(khoa);
    if (this.#so.size >= this.#toiDa) {
      this.#don(luc);
      if (this.#so.size >= this.#toiDa) return Number.POSITIVE_INFINITY;
    }
    this.#so.set(khoa, { n: 1, het: luc + this.#cuaSoMs });
    return 1;
  }

  get soKhoa(): number {
    return this.#so.size;
  }

  #don(luc: number): void {
    for (const [k, v] of this.#so) if (v.het <= luc) this.#so.delete(k);
  }
}
