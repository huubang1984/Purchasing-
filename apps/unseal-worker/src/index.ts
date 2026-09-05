// ==============================================================================================
// apps/unseal-worker — CĂN PHÒNG SAU CÁNH CỬA ĐÃ KHOÁ TỪ S0
//
// Thư mục này được nhắc tên trong `.dependency-cruiser.cjs` từ **fix round 4 của Task 7**, tức là
// từ trước khi nó tồn tại. Hai họ quy tắc canh nó — `g1-` (đường mở bọc khoá của `crypto-keys`)
// và `g8-` (đường mở phong bì của `sealed-envelope`) — và cả hai đều mở đúng MỘT miễn trừ:
// `apps/unseal-worker/`. Ghi chú §4 của bất biến G1 gọi tình trạng ấy bằng một câu:
//
//   *"Ô ✅ này chứng minh CÁNH CỬA ĐÃ KHOÁ; nó chưa chứng minh gì về CĂN PHÒNG, vì căn phòng
//    chưa được xây."*
//
// File này là căn phòng.
//
// ---------------------------------------------------------------------------------------------
// BỐN THỨ TIẾN TRÌNH NÀY LÀ NƠI DUY NHẤT LÀM ĐƯỢC, VÀ MỘT THỨ NÓ KHÔNG LÀM
// ---------------------------------------------------------------------------------------------
//   ✔ mở bọc khoá riêng RFQ              — `crypto-keys/unwrap`, cửa hạn chế của `g1-`
//   ✔ mở phong bì niêm phong             — `sealed-envelope/unseal`, cửa hạn chế của `g8-`
//   ✔ ghi bản rõ vào `rfq_unsealed_bids` — `app_unseal` là role DUY NHẤT có INSERT (019)
//   ✔ tuyên bố RFQ đã `UNSEALED`         — nơi làm việc cũng là nơi tuyên bố (019 mục 4)
//
//   ✘ **KHÔNG** phán xử quyền hay MFA. `app_unseal` cố ý không đọc được `users` (002) hay ma
//     trận quyền (005), nên hai vế đầu của D1 là những câu tiến trình này KHÔNG HỎI ĐƯỢC. Cổng
//     bốn vế chạy ở `dispatchUnseal` phía `api`; ở đây chỉ còn hai vế cuối, và chúng được CSDL
//     giữ bằng trigger chứ không bằng mã của file này. Phần chênh ấy nằm ở §4 của D1.
// ==============================================================================================

import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import type { KeyUnwrapper } from "@trustprocure/crypto-keys/unwrap";
import { unsealBid } from "@trustprocure/sealed-envelope/unseal";

export class UnsealWorkerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UnsealWorkerError";
  }
}

export interface ExecuteUnsealInput {
  readonly unsealRequestId: string;
  readonly unwrapper: KeyUnwrapper;
}

export interface UnsealOutcome {
  readonly unsealRequestId: string;
  readonly rfqId: string;
  /** Số phong bì đã mở được. */
  readonly opened: number;
  /** Số phong bì mở KHÔNG được — xem chú thích của `thanhJson`. */
  readonly failed: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface HangYeuCau {
  readonly rfq_id: string;
  readonly status: string;
}

interface HangKhoa {
  readonly algorithm: string;
  readonly wrapped_private_key: Buffer;
  readonly key_version: string;
}

interface HangPhongBi {
  readonly id: string;
  readonly envelope: Buffer;
}

/**
 * Chuyển bản rõ thành `jsonb`.
 *
 * MỘT QUYẾT ĐỊNH VỀ SẴN SÀNG, không phải về định dạng: nếu bản rõ không phải một đối tượng JSON
 * thì nó được cất dưới `{ "raw": "..." }` thay vì làm cả lượt mở thầu hỏng. Một nhà cung cấp gửi
 * rác — cố ý hay do lỗi trình duyệt — KHÔNG được phép chặn việc mở báo giá của những người khác.
 *
 * Bản rõ không bao giờ bị VỨT ĐI: nó luôn tới được `rfq_unsealed_bids`, chỉ khác hình dạng.
 */
function thanhJson(banRo: Uint8Array): unknown {
  const van = new TextDecoder("utf-8", { fatal: false }).decode(banRo);
  try {
    const doc: unknown = JSON.parse(van);
    if (typeof doc === "object" && doc !== null && !Array.isArray(doc)) return doc;
    return { raw: van };
  } catch {
    return { raw: van };
  }
}

/**
 * [D1 vế 3+4, C3, D2, G4] Chạy một yêu cầu mở thầu ĐÃ ĐƯỢC PHÊ DUYỆT.
 *
 * Người gọi phải mở transaction và phải nối bằng role `app_unseal`. Hàm này KHÔNG tự `BEGIN`:
 * bản rõ, mốc `EXECUTED` và trạng thái `UNSEALED` phải cùng sống hoặc cùng chết.
 */
export async function executeUnsealRequest(
  client: pg.PoolClient,
  orgId: string,
  input: ExecuteUnsealInput,
): Promise<UnsealOutcome> {
  await assertTenantBound(client, orgId, "executeUnsealRequest");
  if (!UUID_PATTERN.test(input.unsealRequestId)) {
    throw new UnsealWorkerError("unsealRequestId phải là UUID hợp lệ.");
  }

  const { rows: yc } = await client.query<HangYeuCau>(
    "SELECT rfq_id, status FROM unseal_requests WHERE id = $1 FOR NO KEY UPDATE",
    [input.unsealRequestId],
  );
  const r = yc[0];
  if (r === undefined) {
    throw new UnsealWorkerError("không tìm thấy yêu cầu mở thầu trong tổ chức đang gắn");
  }
  if (r.status !== "APPROVED") {
    // Lớp này KHÔNG phải lớp có thẩm quyền — trigger `rfq_unsealed_bids_kiem_yeu_cau` (019) mới
    // là lớp ấy. Nó ở đây để thông báo nói được VÌ SAO, và để không tốn một lần mở bọc khoá.
    throw new UnsealWorkerError(
      `yêu cầu mở thầu phải ở trạng thái APPROVED để chạy; đang ở ${r.status}`,
    );
  }

  const { rows: khoa } = await client.query<HangKhoa>(
    `SELECT algorithm, wrapped_private_key, key_version
       FROM rfq_key_material
      WHERE rfq_id = $1 AND algorithm = 'ECDH_P256' AND revoked_at IS NULL`,
    [r.rfq_id],
  );
  const k = khoa[0];
  if (k === undefined) {
    throw new UnsealWorkerError("RFQ không có vật liệu khoá còn hiệu lực để mở thầu");
  }

  // Chỉ lấy PHIÊN BẢN CUỐI của mỗi luồng báo giá. B1 giữ mọi phiên bản để không ai sửa lén được
  // thứ đã nộp; mở thầu thì chỉ mở thứ nhà cung cấp muốn được chấm — bản cuối trước hạn.
  const { rows: phongBi } = await client.query<HangPhongBi>(
    `SELECT DISTINCT ON (v.bid_id) v.id, v.envelope
       FROM vendor_bid_versions v
       JOIN vendor_bids b ON b.id = v.bid_id AND b.org_id = v.org_id
       JOIN rfq_invitations i ON i.id = b.invitation_id AND i.org_id = b.org_id
      WHERE i.rfq_id = $1
      ORDER BY v.bid_id, v.version DESC`,
    [r.rfq_id],
  );

  const khoaRieng = await input.unwrapper.unwrap(orgId, {
    ciphertext: new Uint8Array(k.wrapped_private_key),
    keyVersion: k.key_version,
  });

  let opened = 0;
  let failed = 0;
  try {
    for (const pb of phongBi) {
      let banRo: Uint8Array;
      try {
        banRo = await unsealBid({
          rfqId: r.rfq_id,
          algorithm: "ECDH_P256",
          envelope: new Uint8Array(pb.envelope),
          recipientPrivateKey: khoaRieng,
        });
      } catch {
        // Một phong bì hỏng KHÔNG dừng lượt mở thầu. Lý do KHÔNG được ghi vào payload: ba nguyên
        // nhân (sai khoá, sai RFQ, bị sửa) cho cùng một câu, và phân biệt được chúng là một oracle.
        failed += 1;
        continue;
      }
      await client.query(
        `INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload)
         VALUES ($1, $2, $3, $4)`,
        [orgId, input.unsealRequestId, pb.id, JSON.stringify(thanhJson(banRo))],
      );
      opened += 1;
    }
  } finally {
    // Cùng khuôn `pkcs8.fill(0)` ở `sealed-envelope/src/key-material.ts`: một lần ném giữa chừng
    // không được để lại khoá riêng RFQ nguyên vẹn trong heap.
    khoaRieng.fill(0);
  }

  // [G4] Vế "MỞ BỌC" của mệnh đề *"mọi thao tác khoá — sinh, bọc, mở bọc, huỷ — đều sinh audit"*.
  // Ở S1.4 vế này không có một dòng mã nào, và ghi chú §4 của G4 nói đúng thế. Dòng dưới đây là
  // vế ấy — và nó ghi được vì `app_unseal` có quyền INSERT theo cột trên `audit_events` (003/004).
  await appendAuditEvent(client, orgId, {
    actorType: "SERVICE",
    actorId: null,
    action: "RFQ_KEY_MATERIAL_UNWRAPPED",
    resourceType: "rfq_key_material",
    resourceId: r.rfq_id,
    payload: {
      unsealRequestId: input.unsealRequestId,
      algorithm: k.algorithm,
      keyVersion: k.key_version,
      opened,
      failed,
    },
  });

  await client.query(
    "UPDATE unseal_requests SET status = 'EXECUTED', executed_at = now() WHERE id = $1",
    [input.unsealRequestId],
  );
  await client.query("UPDATE rfq_packages SET status = 'UNSEALED' WHERE id = $1", [r.rfq_id]);

  await appendAuditEvent(client, orgId, {
    actorType: "SERVICE",
    actorId: null,
    action: "RFQ_UNSEALED",
    resourceType: "rfq_package",
    resourceId: r.rfq_id,
    payload: { unsealRequestId: input.unsealRequestId, opened, failed },
  });

  return { unsealRequestId: input.unsealRequestId, rfqId: r.rfq_id, opened, failed };
}
