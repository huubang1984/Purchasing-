import { createHmac } from "node:crypto";

// =============================================================================================
// ADR-018 — PEPPER CHO BĂM ĐÍCH VÀ BĂM MÃ OTP
//
// ---------------------------------------------------------------------------------------------
// PHÉP ĐO ĐI TRƯỚC, VÀ NÓ LÀ LÝ DO FILE NÀY TỒN TẠI
// ---------------------------------------------------------------------------------------------
// Trên một không gian giả lập 10^4 số, Node 22, một luồng:
//   KHONG pepper -> tim duoc : 0900007321 (11 ms)   |  CO pepper -> tim duoc : null (12 ms)
//   chi phi ~1 bam           : 0.0011 ms            |  ngoai suy 10^9        : 18.3 phut
// Một bản sao lưu CSDL rò ra ngoài không phải một bảng băm — nó là một DANH BẠ.
//
// ---------------------------------------------------------------------------------------------
// VÌ SAO KHÔNG DÙNG LẠI `MasterKeyRing` DÙ HÌNH DẠNG GIỐNG HỆT
// ---------------------------------------------------------------------------------------------
// `MasterKeyRing` của `@trustprocure/crypto-keys` cũng là "khoá 32 byte, có phiên bản, có phiên
// bản đang dùng", và nó đã ở trong barrel công khai. Dùng lại nó sẽ tiết kiệm ~30 dòng.
//
// Nó bị từ chối vì một lý do KHÔNG phải thẩm mỹ: hai vòng khoá cùng KIỂU thì cùng nơi tiêm được,
// và ngày nào đó một composition root sẽ truyền ĐÚNG MỘT đối tượng cho cả hai chỗ. Lúc ấy pepper
// BẰNG khoá bọc phong bì, và một lần lộ pepper thành một lần lộ khoá — hai tài sản có mô hình đe
// doạ khác hẳn nhau bị nối làm một, trong im lặng, bởi một dòng cấu hình. Kiểu riêng làm việc ấy
// KHÔNG viết được thay vì chỉ là "đừng làm thế".
//
// ---------------------------------------------------------------------------------------------
// ĐIỀU FILE NÀY KHÔNG ĐÓNG
// ---------------------------------------------------------------------------------------------
// Pepper chỉ chặn kẻ CHỈ CÓ bản sao lưu CSDL. Kẻ đã ở trong tiến trình `api` có cả hai thứ. Cùng
// hạn chế cấu trúc đã ghi cho E3 ở `packages/identity/src/mfa-credentials.ts` và nhắc lại ở 010
// khi cấp `GRANT DELETE ON otp_rate_limits`.
// =============================================================================================

export class PepperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PepperError";
  }
}

/**
 * Vòng pepper có phiên bản. Cùng KHUÔN `MasterKeyRing`, cố ý KHÁC KIỂU — xem khối trên.
 *
 * Khoá KHÔNG BAO GIỜ được ghi ra: không log, không `outbox_jobs.payload`, không sổ kiểm toán.
 * Vì vậy lớp này không có `toString`/`toJSON` trả về gì hữu ích và giữ khoá ở trường riêng tư.
 */
export class PepperRing {
  readonly #peppers: ReadonlyMap<string, Buffer>;

  constructor(
    readonly activeVersion: string,
    peppers: Readonly<Record<string, Buffer>>,
  ) {
    const cac = Object.entries(peppers);
    if (cac.length === 0) throw new PepperError("Vòng pepper rỗng.");
    for (const [phienBan, khoa] of cac) {
      if (phienBan.length === 0 || phienBan.length > 32) {
        throw new PepperError("Tên phiên bản pepper phải dài 1–32 ký tự.");
      }
      if (khoa.length !== 32) {
        throw new PepperError(
          `Pepper "${phienBan}" phải dài đúng 32 byte, đang là ${khoa.length}.`,
        );
      }
    }
    if (!Object.hasOwn(peppers, activeVersion)) {
      throw new PepperError(`Vòng pepper không chứa phiên bản đang dùng "${activeVersion}".`);
    }
    this.#peppers = new Map(cac);
  }

  /**
   * Băm có pepper của phiên bản ĐANG DÙNG. Trả về cả phiên bản để người gọi ghi nó xuống cùng
   * hàng — trả riêng hai thứ là mời gọi việc ghi băm mà quên ghi phiên bản.
   */
  bam(...phan: readonly string[]): { hash: Buffer; version: string } {
    return { hash: this.bamTheoPhienBan(this.activeVersion, ...phan), version: this.activeVersion };
  }

  /** Băm lại theo một phiên bản CŨ — đường đối chiếu một hàng đã ghi trước lần xoay gần nhất. */
  bamTheoPhienBan(version: string, ...phan: readonly string[]): Buffer {
    const khoa = this.#peppers.get(version);
    if (khoa === undefined) {
      // Ném chứ không trả `null`: một hàng mang phiên bản pepper mà tiến trình không có nghĩa là
      // KHÔNG PHÁN XÉT ĐƯỢC. Trả về "không khớp" ở đây sẽ biến một lỗi cấu hình thành một lần từ
      // chối đăng nhập trông như người dùng gõ sai mã.
      throw new PepperError(`Vòng pepper không có phiên bản "${version}" — không đối chiếu được.`);
    }
    const h = createHmac("sha256", khoa);
    for (const p of phan) h.update(p, "utf8");
    return h.digest();
  }
}
