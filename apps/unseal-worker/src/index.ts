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
//   ✘ **KHÔNG** phán xử QUYỀN. `app_unseal` cố ý không có một GRANT nào trên `user_roles`,
//     `role_permissions` hay `permissions` (005), nên vế 1 của D1 là một câu tiến trình này
//     KHÔNG HỎI ĐƯỢC. Cổng bốn vế chạy ở `dispatchUnseal` phía `api`.
//
// ---------------------------------------------------------------------------------------------
// [REVIEW AN NINH S1.6 — HIGH-3] MỘT CÂU SAI ĐÃ ĐỨNG Ở ĐÂY, VÀ NÓ ĐANG CHẶN MỘT LỚP CÓ THẬT
// ---------------------------------------------------------------------------------------------
// Nguyên văn câu cũ, giữ lại để đối chiếu:
//
//   ~~*"`app_unseal` cố ý không đọc được `users` (002) hay ma trận quyền (005), nên HAI vế đầu~~
//   ~~của D1 là những câu tiến trình này KHÔNG HỎI ĐƯỢC."*~~
//
// **Vế `users` của câu ấy SAI.** `006_sessions_and_mfa.sql:232` cấp
// `SELECT (id, org_id, status) ON users TO app_unseal`, và `:305` cấp đúng sáu cột của `sessions`
// mà `assertFreshMfa` đọc — chính 006 ghi rằng nó cấp *"vì bất biến D1"*. Tức vế 2 (MFA còn hiệu
// lực) **hỏi được ở đây**, và một câu sai đã dùng để biện minh cho việc không hỏi nó, trên đúng
// hành động không thu hồi được của cả hệ thống.
//
// Nay nó được hỏi: `executeUnsealRequest` chạy lại `assertFreshMfa` trên PHIÊN ĐÃ ĐIỀU PHỐI, với
// một cửa sổ riêng của lúc GIẢI MÃ. Chỉ vế 1 (quyền) là thật sự không hỏi được ở đây.
// ==============================================================================================

import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { assertFreshMfa } from "@trustprocure/identity";
import type { KeyUnwrapper } from "@trustprocure/crypto-keys/unwrap";
import {
  KEY_AGREEMENT_ALGORITHMS,
  describeEnvelope,
  type KeyAgreementAlgorithm,
} from "@trustprocure/sealed-envelope";
import { unsealBid } from "@trustprocure/sealed-envelope/unseal";

export class UnsealWorkerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UnsealWorkerError";
  }
}

/**
 * Cửa sổ MFA ở thời điểm GIẢI MÃ — rộng hơn cửa sổ 15 phút của lúc điều phối, và có lý do.
 *
 * Hai thời điểm hỏi hai câu khác nhau. Lúc điều phối, câu hỏi là *"người này VỪA chứng minh danh
 * tính chưa"* — 15 phút là câu trả lời đúng. Lúc giải mã, câu hỏi là *"uỷ quyền này còn sống
 * không, hay nó đã nằm trong hàng đợi qua một sự cố"* — và một hàng đợi bị nghẽn nửa giờ là
 * chuyện vận hành bình thường, không phải một cuộc tấn công.
 *
 * Thứ nó ĐÓNG là ca mà `assertFreshMfa` cũng kiểm cùng lúc và không có cửa sổ nào cả: phiên bị
 * THU HỒI, phiên HẾT HẠN, hoặc người dùng không còn `ACTIVE`. Ba thứ ấy chặn ngay lập tức.
 */
export const UNSEAL_DECRYPT_MFA_MAX_AGE_SECONDS = 60 * 60;

export interface ExecuteUnsealInput {
  readonly unsealRequestId: string;
  readonly unwrapper: KeyUnwrapper;
  /** Ghi đè cửa sổ MFA lúc giải mã — chỉ để test đo được cả hai phía của ngưỡng. */
  readonly maxMfaAgeSeconds?: number;
}

export interface UnsealOutcome {
  readonly unsealRequestId: string;
  readonly rfqId: string;
  /** Số phong bì đã mở được. */
  readonly opened: number;
  /**
   * Các phiên bản báo giá KHÔNG mở được — ĐÍCH DANH, không phải một con số.
   *
   * [REVIEW AN NINH S1.4 — HIGH-2] Bản trước chỉ đếm. Một con số làm *"đã mở 4 trên 5 và đi
   * tiếp"* không phân biệt được với *"đã mở 5 trên 5"* ở mọi chỗ phía sau — và trong một hệ đấu
   * thầu kín thì đó là một hỏng hóc về CÔNG BẰNG, không phải một dòng log thiếu.
   *
   * LÝ DO thất bại CỐ Ý không được ghi: ba nguyên nhân (sai khoá, sai RFQ, bị sửa) cho cùng một
   * câu, và phân biệt được chúng là một oracle. Danh tính hàng thì không phải oracle — nhà cung
   * cấp đã biết mình nộp gì.
   */
  readonly failedBidVersionIds: readonly string[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface HangYeuCau {
  readonly rfq_id: string;
  readonly status: string;
  readonly dispatched_by: string | null;
  readonly dispatched_by_session_id: string | null;
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

function laThuatToanBiet(x: string): x is KeyAgreementAlgorithm {
  return (KEY_AGREEMENT_ALGORITHMS as readonly string[]).includes(x);
}

/**
 * Chuyển bản rõ thành `jsonb`.
 *
 * MỘT QUYẾT ĐỊNH VỀ SẴN SÀNG, không phải về định dạng: nếu bản rõ không phải một đối tượng JSON
 * thì nó được cất dưới `{ "raw": "..." }` thay vì làm cả lượt mở thầu hỏng. Một nhà cung cấp gửi
 * rác — cố ý hay do lỗi trình duyệt — KHÔNG được phép chặn việc mở báo giá của những người khác.
 *
 * Bản rõ không bao giờ bị VỨT ĐI: nó luôn tới được `rfq_unsealed_bids`, chỉ khác hình dạng.
 *
 * [REVIEW AN NINH S1.6 — HIGH-1] `U+0000` BỊ GỠ, VÀ ĐÓ LÀ MỘT LỖ HỔNG SẴN SÀNG CÓ THẬT.
 * Kiểu `jsonb` của PostgreSQL KHÔNG biểu diễn được `U+0000` trong chuỗi — nó ném `22P05`. Câu
 * bảo đảm ở đoạn trên được viết cho bước GIẢI MÃ, còn bước GHI thì không được che: một byte NUL
 * duy nhất trong bản rõ của MỘT nhà cung cấp làm cả giao dịch rollback, và lượt mở thầu ấy hỏng
 * lại y hệt ở mọi lần thử lại. Tức một nhà cung cấp khoá được cả cuộc thầu bằng một byte.
 *
 * Gỡ ở đây, chứ không chỉ bắt lỗi ở chỗ ghi: một `payload` không cất được là dữ liệu đã MẤT, còn
 * một `payload` đã gỡ NUL là dữ liệu đã cất được kèm một sai lệch đọc được từ chính nó.
 */
function thanhJson(banRo: Uint8Array): unknown {
  const van = new TextDecoder("utf-8", { fatal: false })
    .decode(banRo)
    .replace(/ /gu, "");
  try {
    const doc: unknown = JSON.parse(van);
    if (typeof doc === "object" && doc !== null && !Array.isArray(doc)) return doc;
    return { raw: van };
  } catch {
    return { raw: van };
  }
}

/**
 * [D1 vế 2+3+4, C3, D2, G4] Chạy một yêu cầu mở thầu ĐÃ ĐƯỢC PHÊ DUYỆT.
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
    "SELECT rfq_id, status, dispatched_by, dispatched_by_session_id FROM unseal_requests " +
      " WHERE id = $1 AND org_id = $2 FOR NO KEY UPDATE",
    [input.unsealRequestId, orgId],
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

  // [D1 vế 2, đo LẠI ở thời điểm GIẢI MÃ] Xem khối [HIGH-3] ở đầu file. Một phiên bị thu hồi
  // ngay sau khi điều phối KHÔNG còn dẫn tới một lượt mở thầu chạy trọn.
  if (r.dispatched_by_session_id === null || r.dispatched_by === null) {
    throw new UnsealWorkerError(
      "yêu cầu mở thầu không mang phiên đã điều phối — không kiểm lại được MFA (D1 vế 2)",
    );
  }
  await assertFreshMfa(client, {
    sessionId: r.dispatched_by_session_id,
    userId: r.dispatched_by,
    orgId,
    maxAgeSeconds: input.maxMfaAgeSeconds ?? UNSEAL_DECRYPT_MFA_MAX_AGE_SECONDS,
  });

  // [REVIEW AN NINH S1.6 — LOW-3] Lấy MỌI khoá còn hiệu lực, và ném nếu một thuật toán có HAI
  // hàng. Bản trước lấy `khoa[0]` không `ORDER BY`: hai hàng còn hiệu lực làm mọi phong bì rơi
  // vào nhánh thất bại trong khi hàm vẫn báo thành công và vẫn lật RFQ sang `UNSEALED`.
  const { rows: khoa } = await client.query<HangKhoa>(
    `SELECT algorithm, wrapped_private_key, key_version
       FROM rfq_key_material
      WHERE rfq_id = $1 AND org_id = $2 AND revoked_at IS NULL
      ORDER BY algorithm`,
    [r.rfq_id, orgId],
  );
  const theoThuatToan = new Map<string, HangKhoa>();
  for (const k of khoa) {
    if (theoThuatToan.has(k.algorithm)) {
      throw new UnsealWorkerError(
        `RFQ có HAI vật liệu khoá còn hiệu lực cho ${k.algorithm} — không chọn hộ được`,
      );
    }
    theoThuatToan.set(k.algorithm, k);
  }
  if (theoThuatToan.size === 0) {
    throw new UnsealWorkerError("RFQ không có vật liệu khoá còn hiệu lực để mở thầu");
  }

  // Chỉ lấy PHIÊN BẢN CUỐI của mỗi luồng báo giá. B1 giữ mọi phiên bản để không ai sửa lén được
  // thứ đã nộp; mở thầu thì chỉ mở thứ nhà cung cấp muốn được chấm — bản cuối trước hạn.
  const { rows: phongBi } = await client.query<HangPhongBi>(
    `SELECT DISTINCT ON (v.bid_id) v.id, v.envelope
       FROM vendor_bid_versions v
       JOIN vendor_bids b ON b.id = v.bid_id AND b.org_id = v.org_id
       JOIN rfq_invitations i ON i.id = b.invitation_id AND i.org_id = b.org_id
      WHERE i.rfq_id = $1 AND v.org_id = $2
      ORDER BY v.bid_id, v.version DESC`,
    [r.rfq_id, orgId],
  );

  // ---------------------------------------------------------------------------------------
  // [REVIEW AN NINH S1.4 — HIGH-1] KHOÁ ĐƯỢC CHỌN THEO THỨ PHONG BÌ TỰ KHAI, KHÔNG THEO MỘT
  // HẰNG SỐ CHÉP TAY.
  //
  // Bản trước đọc `WHERE algorithm = 'ECDH_P256'` và truyền `algorithm: "ECDH_P256"` vào
  // `unsealBid`. Cùng lúc đó `issueRfqKeyPair` mặc định sinh CẢ HAI cặp khoá và
  // `chooseKeyAgreementAlgorithm` **ưu tiên X25519**. Hệ quả: một nhà cung cấp dùng trình duyệt
  // hiện đại niêm phong bằng X25519, NHẬN MỘT BIÊN NHẬN ĐÃ KÝ chứng minh nộp đúng hạn, rồi báo
  // giá của họ rơi vào nhánh `failed` trong im lặng — và `app_api` không đọc được `envelope` nên
  // sau đó không ai khôi phục hay chẩn đoán được nữa.
  //
  // Đây là lý do định dạng phong bì TỰ MÔ TẢ ngay từ ADR-011: `describeEnvelope` đọc mã thuật
  // toán từ chính header đã được AAD ràng buộc, nên nó không nói dối được mà không hỏng tag.
  // ---------------------------------------------------------------------------------------
  const khoaRieng = new Map<KeyAgreementAlgorithm, Uint8Array>();
  let opened = 0;
  const failedBidVersionIds: string[] = [];
  try {
    for (const pb of phongBi) {
      const byte = new Uint8Array(pb.envelope);
      let banRo: Uint8Array;
      try {
        const thuatToan = describeEnvelope(byte).algorithm;
        if (!laThuatToanBiet(thuatToan)) throw new UnsealWorkerError("thuật toán lạ");
        let rieng = khoaRieng.get(thuatToan);
        if (rieng === undefined) {
          const k = theoThuatToan.get(thuatToan);
          if (k === undefined) throw new UnsealWorkerError("RFQ không có khoá cho thuật toán này");
          rieng = await input.unwrapper.unwrap(orgId, {
            ciphertext: new Uint8Array(k.wrapped_private_key),
            keyVersion: k.key_version,
          });
          khoaRieng.set(thuatToan, rieng);
        }
        banRo = await unsealBid({
          rfqId: r.rfq_id,
          algorithm: thuatToan,
          envelope: byte,
          recipientPrivateKey: rieng,
        });
      } catch {
        // Một phong bì hỏng KHÔNG dừng lượt mở thầu. Lý do KHÔNG được ghi vào payload: ba nguyên
        // nhân (sai khoá, sai RFQ, bị sửa) cho cùng một câu, và phân biệt được chúng là một oracle.
        failedBidVersionIds.push(pb.id);
        continue;
      }
      try {
        await client.query(
          `INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload)
           VALUES ($1, $2, $3, $4)`,
          [orgId, input.unsealRequestId, pb.id, JSON.stringify(thanhJson(banRo))],
        );
        opened += 1;
      } finally {
        // [REVIEW AN NINH S1.6 — LOW-2] Bản rõ cũng là bí mật, không chỉ khoá. Chuỗi mà
        // `thanhJson` dựng ra thì bất biến và không xoá được — ghi ra như một dư lượng đã biết
        // thay vì im lặng.
        banRo.fill(0);
      }
    }
  } finally {
    // Cùng khuôn `pkcs8.fill(0)` ở `sealed-envelope/src/key-material.ts`: một lần ném giữa chừng
    // không được để lại khoá riêng RFQ nguyên vẹn trong heap.
    for (const rieng of khoaRieng.values()) rieng.fill(0);
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
      algorithms: [...khoaRieng.keys()].sort(),
      opened,
      failedBidVersionIds,
    },
  });

  // [REVIEW AN NINH S1.6 — LOW-1] Hai câu kết thúc mang `org_id` TƯỜNG MINH và một vế trạng
  // thái, và `rowCount` được kiểm. `runner.ts` của outbox đã ghi rằng *"RLS đã thu hẹp tập hàng"*
  // là một câu ĐO ĐƯỢC LÀ SAI với một phiên `BYPASSRLS`; worker không được là chỗ ngoại lệ.
  const kt1 = await client.query(
    "UPDATE unseal_requests SET status = 'EXECUTED', executed_at = now() " +
      " WHERE id = $1 AND org_id = $2 AND status = 'APPROVED'",
    [input.unsealRequestId, orgId],
  );
  if (kt1.rowCount !== 1) {
    throw new UnsealWorkerError("không đóng được yêu cầu mở thầu — trạng thái đã đổi giữa chừng");
  }
  const kt2 = await client.query(
    "UPDATE rfq_packages SET status = 'UNSEALED' WHERE id = $1 AND org_id = $2 AND status = 'CLOSED'",
    [r.rfq_id, orgId],
  );
  if (kt2.rowCount !== 1) {
    throw new UnsealWorkerError("không tuyên bố được RFQ đã UNSEALED — trạng thái đã đổi giữa chừng");
  }

  await appendAuditEvent(client, orgId, {
    actorType: "SERVICE",
    actorId: null,
    action: "RFQ_UNSEALED",
    resourceType: "rfq_package",
    resourceId: r.rfq_id,
    payload: { unsealRequestId: input.unsealRequestId, opened, failedBidVersionIds },
  });

  return {
    unsealRequestId: input.unsealRequestId,
    rfqId: r.rfq_id,
    opened,
    failedBidVersionIds,
  };
}
