// ==============================================================================================
// S1.8 — [B5] JOB TOÀN VẸN: CIPHERTEXT LƯU TRỮ CÒN KHỚP HASH TRONG BIÊN NHẬN KHÔNG
//
// ----------------------------------------------------------------------------------------------
// PHÉP ĐO NÀY KHÔNG PHẢI MỘT LỚP PHÒNG THỦ — NÓ LÀ MỘT LỚP PHÁT HIỆN, VÀ HAI THỨ ĐÓ KHÁC NHAU
// ----------------------------------------------------------------------------------------------
// Lớp PHÒNG THỦ của B1 đã có và mạnh hơn: `bid_chi_ghi_them` (018) chặn UPDATE và DELETE trên
// `vendor_bid_versions` ở tầng trigger, tức chặn cả CHỦ SỞ HỮU BẢNG. Một phong bì không sửa được
// thì nó không lệch hash được.
//
// Vậy job này canh cái gì? Đúng những đường mà một trigger KHÔNG canh: khôi phục từ bản sao lưu
// hỏng, một lần `ALTER TABLE ... DISABLE TRIGGER` trong một script vận hành, hỏng đĩa, hay một
// lần di trú dữ liệu viết vội. Đó là lý do mệnh đề B5 nói *"tại mọi thời điểm VỀ SAU"* — nó là
// một mệnh đề về THỜI GIAN VẬN HÀNH, không về đường ghi.
//
// ----------------------------------------------------------------------------------------------
// PHẢI GỌI BẰNG MỘT CLIENT CỦA ROLE `app_unseal`
// ----------------------------------------------------------------------------------------------
// Và không phải vì tiện: `app_api` KHÔNG đọc được `envelope` (A3/G1), nên một lần gọi nhầm role
// hỏng ỒN ÀO với `permission denied` chứ không âm thầm trả về "mọi thứ đều khớp". Quyền đọc
// `bid_receipts.canonical_text` của `app_unseal` là thứ migration 021 mở ra, và chỉ ba cột.
//
// Hàm này KHÔNG kiểm chữ ký của biên nhận. Đó là B2, và B2 đòi phép kiểm ấy làm được bằng khoá
// công khai MỘT MÌNH — tức bởi nhà cung cấp. `signature` cố ý không nằm trong quyền của
// `app_unseal`; xem khối lý do ở 021.
// ==============================================================================================

import type pg from "pg";
import { assertTenantBound } from "@trustprocure/audit";
import { parseReceiptText, sha256Hex } from "./receipt.js";
import { BiddingError } from "./bidding.js";

export interface CiphertextAuditRow {
  readonly bidVersionId: string;
  /** Chuỗi hash ĐỌC TỪ biên nhận đã ký. */
  readonly expectedSha256: string;
  /** Chuỗi hash BĂM LẠI từ phong bì đang nằm trong bảng. */
  readonly actualSha256: string;
}

export interface CiphertextAuditReport {
  readonly rfqId: string;
  /**
   * [REVIEW AN NINH S1.7 — LOW-1] PHÁN QUYẾT NẰM TRONG KIỂU, KHÔNG TRONG ĐẦU NGƯỜI GỌI.
   *
   * Vị từ tự nhiên mà một người viết giám sát sẽ gõ là `mismatched.length === 0` — và nó IM
   * LẶNG đúng trong ca tệ nhất: một lần khôi phục làm mất `bid_receipts` thì không còn gì để so,
   * `mismatched` rỗng, và báo cáo trông sạch trong khi phép so đã trở thành BẤT KHẢ. `ok` gộp cả
   * bốn điều kiện, kể cả `checked === total`.
   */
  readonly ok: boolean;
  /** Tổng số phiên bản báo giá của RFQ — mẫu số của `checked`. */
  readonly total: number;
  /** Số phiên bản báo giá đã băm lại và so được. */
  readonly checked: number;
  /** Các phiên bản mà hai chuỗi hash LỆCH nhau. Rỗng là kết quả mong đợi. */
  readonly mismatched: readonly CiphertextAuditRow[];
  /**
   * Các phiên bản KHÔNG có biên nhận để so.
   *
   * Tách khỏi `mismatched` vì hai thứ này gọi hai việc khác nhau: một biên nhận thiếu là một
   * khiếm khuyết của đường GHI (và trigger hoãn `bid_phai_co_bien_nhan` của 018 lẽ ra đã chặn),
   * còn một chuỗi hash lệch là một khiếm khuyết của đường LƯU. Gộp chúng lại sẽ làm người trực
   * đêm đi sai hướng ngay từ dòng đầu.
   */
  readonly missingReceipt: readonly string[];
  /** Các phiên bản có biên nhận nhưng biên nhận KHÔNG đọc ra được — hỏng định dạng. */
  readonly unparsableReceipt: readonly string[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface HangKiem {
  readonly id: string;
  readonly envelope: Buffer;
  readonly canonical_text: string | null;
}

/**
 * [B5] Băm lại mọi phong bì của một RFQ và so với chuỗi hash trong biên nhận đã ký.
 *
 * Trả về một BÁO CÁO thay vì ném khi có lệch. Đó là hình dạng đúng cho một job định kỳ: nó phải
 * kiểm hết rồi mới nói, chứ không dừng ở phiên bản hỏng đầu tiên — người trực đêm cần biết một
 * hàng lệch hay ba nghìn hàng lệch, và hai con số ấy dẫn tới hai quyết định khác hẳn nhau.
 */
export async function auditStoredCiphertexts(
  client: pg.PoolClient,
  orgId: string,
  rfqId: string,
): Promise<CiphertextAuditReport> {
  await assertTenantBound(client, orgId, "auditStoredCiphertexts");
  if (!UUID_PATTERN.test(rfqId)) {
    throw new BiddingError(`rfqId phải là UUID hợp lệ, nhận được: "${rfqId}".`);
  }

  const { rows } = await client.query<HangKiem>(
    `SELECT v.id, v.envelope, r.canonical_text
       FROM vendor_bid_versions v
       JOIN vendor_bids b     ON b.id = v.bid_id        AND b.org_id = v.org_id
       JOIN rfq_invitations i ON i.id = b.invitation_id AND i.org_id = b.org_id
       LEFT JOIN bid_receipts r ON r.bid_version_id = v.id AND r.org_id = v.org_id
      WHERE i.rfq_id = $1
      ORDER BY v.id`,
    [rfqId],
  );

  const mismatched: CiphertextAuditRow[] = [];
  const missingReceipt: string[] = [];
  const unparsableReceipt: string[] = [];
  let checked = 0;

  for (const h of rows) {
    if (h.canonical_text === null) {
      missingReceipt.push(h.id);
      continue;
    }
    let mong: string;
    try {
      mong = parseReceiptText(h.canonical_text).ciphertextSha256;
    } catch {
      unparsableReceipt.push(h.id);
      continue;
    }
    const that = await sha256Hex(new Uint8Array(h.envelope));
    checked += 1;
    if (that !== mong) {
      mismatched.push({ bidVersionId: h.id, expectedSha256: mong, actualSha256: that });
    }
  }

  return {
    rfqId,
    ok:
      mismatched.length === 0 &&
      missingReceipt.length === 0 &&
      unparsableReceipt.length === 0 &&
      checked === rows.length,
    total: rows.length,
    checked,
    mismatched,
    missingReceipt,
    unparsableReceipt,
  };
}
