// ==============================================================================================
// [khoản 165] DẤU KIỂM CỦA VÒNG KHOÁ BỌC — BÊN KHỞI ĐỘNG TRƯỚC GHI, BÊN SAU SO
//
// `apps/api` và `apps/unseal-worker` cùng đọc `TRUSTPROCURE_MASTER_KEYS`, mỗi tiến trình từ môi
// trường riêng của nó. Dán nhầm ở một bên thì bên ấy vẫn lên (32 byte, base64 hợp lệ) và chỉ hỏng
// lúc mở phong bì thật. Hàm dưới đây là phép đối chiếu KHÔNG cần giữ chung bí mật nào: mỗi bên chỉ
// gửi `HMAC(khoá, hằng)` của từng phiên bản nó giữ, và bảng `master_key_check_values` (`062`) là
// nơi hai dấu gặp nhau.
//
// Vì sao không "thử mở bọc một khoá RFQ có sẵn": bản bọc không mang dấu nào của master key, nên
// phép thử ấy là GIẢI MÃ THẬT một khoá riêng RFQ ngoài cổng D1. Xem khối đầu `062`.
//
// Hàm ở `packages/db` chứ không ở `crypto-keys`: nó là một lần đọc-ghi CSDL, và `crypto-keys`
// không có đường nào tới CSDL (cũng không nên có). Phép băm là `node:crypto` trần, không mượn gì
// của `crypto-keys` — nó không giải mã, không bọc, không cần khả năng nào mà `g1-` canh.
// ==============================================================================================

import { createHmac } from "node:crypto";
import type pg from "pg";

/** Chuỗi hằng được HMAC — đổi nó là đổi mọi dấu kiểm, nên nó mang phiên bản. */
const NHAN_DAU_KIEM = "trustprocure/dau-kiem-vong-khoa/v1";

/** Dấu kiểm của MỘT khoá: HMAC-SHA256(khoá, hằng). Không suy ngược ra khoá được. */
export function tinhDauKiemKhoa(khoa: Uint8Array): Buffer {
  return createHmac("sha256", khoa).update(NHAN_DAU_KIEM, "utf8").digest();
}

/** Lỗi khi dấu kiểm lệch — chỉ nêu TÊN phiên bản, không nêu dấu hay khoá. */
export class DauKiemVongKhoaLechError extends Error {
  public constructor(
    public readonly tenVong: string,
    public readonly phienBanLech: readonly string[],
  ) {
    super(
      `${tenVong}: dấu kiểm của phiên bản ${phienBanLech.map((p) => `"${p}"`).join(", ")} KHÁC dấu đã ghi ` +
        "trong public.master_key_check_values bởi tiến trình khởi động trước (apps/api hay apps/unseal-worker). " +
        "Hai tiến trình đang giữ HAI khoá khác nhau dưới cùng một tên phiên bản — phong bì bọc bởi bên này " +
        "sẽ không mở được ở bên kia. Kiểm lại giá trị đã dán vào biến môi trường của tiến trình này. " +
        "Xoay khoá thì thêm PHIÊN BẢN mới, không thay khoá của một phiên bản cũ (khoản 165, migration 062).",
    );
    this.name = "DauKiemVongKhoaLechError";
  }
}

/**
 * Ghi dấu kiểm của mọi phiên bản mà CHƯA có ai ghi, rồi so MỌI phiên bản với dấu đã ghi.
 *
 * `ON CONFLICT DO NOTHING` làm hai tiến trình khởi động cùng lúc an toàn: đúng một bên thắng lần
 * ghi, và bên kia so với chính dòng ấy. Ném `DauKiemVongKhoaLechError` nếu lệch. Chạy trên một
 * client của pool vai ứng dụng; bảng NGOÀI cây tenant nên không cần `withTenant`.
 */
export async function doiChieuDauKiemVongKhoa(
  client: pg.PoolClient,
  tenVong: string,
  khoa: Readonly<Record<string, Uint8Array>>,
): Promise<void> {
  const phienBan = Object.keys(khoa).sort();
  const dau = phienBan.map((p) => tinhDauKiemKhoa(khoa[p] as Uint8Array));

  // Một câu cho mỗi phiên bản — một vòng khoá có vài phiên bản, và câu đơn giữ được phép đọc
  // SQL của [INV-H21] (bộ đọc ấy không hiểu `ROWS FROM (…)` nhiều hàm).
  for (const [i, p] of phienBan.entries()) {
    await client.query(
      `INSERT INTO public.master_key_check_values (key_version, kcv)
       VALUES ($1::pg_catalog.text, $2::pg_catalog.bytea)
       ON CONFLICT (key_version) DO NOTHING`,
      [p, dau[i]],
    );
  }
  const { rows } = await client.query<{ key_version: string; kcv: Buffer }>(
    `SELECT m.key_version, m.kcv FROM public.master_key_check_values m
      WHERE m.key_version OPERATOR(pg_catalog.=) ANY ($1::pg_catalog.text[])`,
    [phienBan],
  );
  const daGhi = new Map(rows.map((r) => [r.key_version, r.kcv]));

  const lech = phienBan.filter((p, i) => {
    const g = daGhi.get(p);
    // Không đọc lại được dòng vừa ghi thì cũng là LỆCH: RLS lọc hết, hay quyền bị gỡ — một phép
    // kiểm không đo được gì không được đọc thành "khớp".
    return g === undefined || !g.equals(dau[i] as Buffer);
  });
  if (lech.length > 0) throw new DauKiemVongKhoaLechError(tenVong, lech);
}
