// ==============================================================================================
// VÒNG ĐỜI VẬT LIỆU KHOÁ CỦA MỘT RFQ — [ADR-019]
//
// Đây là chỗ ADR-019 mục 1 được cài đặt, và câu chịu lực của cả file là một câu về thứ KHÔNG có
// trong bất kỳ kiểu trả về nào: **không hàm nào ở đây trả về khoá riêng dạng rõ.** `issueRfqKeyPair`
// sinh nó, bọc nó, xoá chuỗi byte đã xuất, rồi trả về đúng bốn thứ mà thế giới bên ngoài được
// biết: thuật toán, khoá công khai, khoá riêng ĐÃ BỌC, và phiên bản khoá gốc đã bọc.
//
// GIỚI HẠN ĐƯỢC GHI RA, KHÔNG ĐƯỢC KHAI RỘNG (cùng câu với ghi chú §4 của G1): `fill(0)` xoá được
// chuỗi byte PKCS8 mà chúng ta tự xuất ra. Nó KHÔNG xoá được phần khoá nằm bên trong đối tượng
// `CryptoKey` của runtime — thứ đó do bộ thu gom rác định đoạt. Nghĩa là tiến trình `api` CÓ chạm
// khoá riêng dạng rõ trong cửa sổ của đúng hàm này, và một core dump đúng lúc ấy chứa nó. Đó là
// phần thu hẹp MỚI của G1 do ADR-019 tạo ra, và nó phải nằm ở §4 của ma trận.
// ==============================================================================================

import type { webcrypto } from "node:crypto";
import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import type { KeyWrapper } from "@trustprocure/crypto-keys";
import { resolveSessionActor } from "@trustprocure/identity";
import {
  assertAlgorithm,
  assertRfqId,
  KEY_AGREEMENT_ALGORITHMS,
  SealedEnvelopeError,
  subtle,
  type KeyAgreementAlgorithm,
} from "./format.js";

/**
 * Thuật toán MẶC ĐỊNH của ADR-011, bản sao ĐỂ ĐỌC của `public.rfq_thuat_toan_mac_dinh()` trong
 * migration 017. Bản có thẩm quyền là bản trong CSDL — trigger `rfq_packages_kiem_khoa_khi_mo`
 * đọc nó, và trigger canh MỌI đường. `hang-so.test.ts` đọc thẳng file SQL và đòi hai bên khớp —
 * cùng khuôn `RFQ_TRANSITIONS` của `packages/rfq`, và cùng lý do: hai bản chép của một hằng sẽ
 * trôi khỏi nhau, và bản trôi sẽ là bản không ai chạy.
 */
export const DEFAULT_KEY_AGREEMENT_ALGORITHM: KeyAgreementAlgorithm = "ECDH_P256";

export interface RfqPublicKeyRecord {
  readonly algorithm: KeyAgreementAlgorithm;
  readonly publicKey: Uint8Array;
  readonly keyVersion: string;
  readonly revokedAt: Date | null;
}

export interface IssueRfqKeyPairInput {
  readonly rfqId: string;
  /** [ADR-016] Phiên của chính người mở RFQ. Danh tính là DẪN XUẤT, không phải tham số. */
  readonly actorSessionId: string;
  readonly wrapper: KeyWrapper;
  /**
   * Thuật toán cần sinh. Mặc định là CẢ HAI — ADR-011 mục 3: `X25519` không được làm điều kiện
   * để nộp thầu, nên `ECDH_P256` luôn phải có mặt; và mục 1: `X25519` là đường nâng cấp cơ hội,
   * nên nó cũng phải có mặt thì mới có gì để nâng cấp.
   */
  readonly algorithms?: readonly KeyAgreementAlgorithm[];
}

interface HangKhoa {
  readonly algorithm: string;
  readonly public_key: Buffer;
  readonly key_version: string;
  readonly revoked_at: Date | null;
}

function doiKhoa(hang: HangKhoa): RfqPublicKeyRecord {
  assertAlgorithm(hang.algorithm);
  return {
    algorithm: hang.algorithm,
    publicKey: new Uint8Array(hang.public_key),
    keyVersion: hang.key_version,
    revokedAt: hang.revoked_at,
  };
}

function thamSoSinh(
  algorithm: KeyAgreementAlgorithm,
): webcrypto.EcKeyGenParams | webcrypto.AlgorithmIdentifier {
  return algorithm === "ECDH_P256" ? { name: "ECDH", namedCurve: "P-256" } : { name: "X25519" };
}

/**
 * Sinh một cặp khoá, bọc khoá riêng, và KHÔNG trả khoá riêng ra ngoài.
 *
 * Hàm này cố ý KHÔNG chạm CSDL: nó là phần mật mã thuần, nên nó test được riêng, và nó không có
 * đường nào để lỡ tay ghi khoá riêng xuống đâu cả.
 */
async function sinhVaBoc(
  wrapper: KeyWrapper,
  orgId: string,
  algorithm: KeyAgreementAlgorithm,
): Promise<{ publicKey: Uint8Array; wrapped: Uint8Array; keyVersion: string }> {
  const s = subtle();
  const cap = (await s.generateKey(thamSoSinh(algorithm), true, ["deriveBits"])) as webcrypto.CryptoKeyPair;
  const publicKey = new Uint8Array(await s.exportKey("spki", cap.publicKey));
  const pkcs8 = new Uint8Array(await s.exportKey("pkcs8", cap.privateKey));
  try {
    const daBoc = await wrapper.wrap(orgId, pkcs8);
    return {
      publicKey,
      wrapped: new Uint8Array(daBoc.ciphertext),
      keyVersion: daBoc.keyVersion,
    };
  } finally {
    // Trong `finally` chứ không sau lời gọi: một lần ném từ `wrap()` không được để lại bản rõ
    // nguyên vẹn trong heap. Cùng khuôn `orgKey.fill(0)` ở `crypto-keys/src/local-dev-wrapper.ts`.
    pkcs8.fill(0);
  }
}

/**
 * [C5 / G2 / G4] Sinh vật liệu khoá cho một RFQ đang được mở.
 *
 * Hàm này KHÔNG mở RFQ, và nó không đứng một mình được: migration 017 đòi RFQ ở `PENDING_APPROVAL`
 * lúc INSERT, và đòi RFQ đã sang `OPEN` lúc COMMIT. Tức gọi nó ngoài giao dịch mở RFQ là một lỗi
 * mà CSDL báo, không phải một lỗi mà tài liệu nhắc.
 */
export async function issueRfqKeyPair(
  client: pg.PoolClient,
  orgId: string,
  input: IssueRfqKeyPairInput,
): Promise<readonly RfqPublicKeyRecord[]> {
  await assertTenantBound(client, orgId, "issueRfqKeyPair");
  assertRfqId(input.rfqId);
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  const thuatToan = input.algorithms ?? KEY_AGREEMENT_ALGORITHMS;
  if (thuatToan.length === 0) {
    throw new SealedEnvelopeError("Phải sinh ít nhất một cặp khoá.");
  }
  if (!thuatToan.includes(DEFAULT_KEY_AGREEMENT_ALGORITHM)) {
    // Fail-closed ở tầng ứng dụng cho đúng thứ trigger (c) của 017 cũng chặn — nhưng ở đây thông
    // báo nói được VÌ SAO, còn trigger chỉ nói RFQ không mở được.
    throw new SealedEnvelopeError(
      `Thuật toán mặc định ${DEFAULT_KEY_AGREEMENT_ALGORITHM} bắt buộc phải có mặt (ADR-011 mục 3).`,
    );
  }

  const ra: RfqPublicKeyRecord[] = [];
  for (const algorithm of thuatToan) {
    const { publicKey, wrapped, keyVersion } = await sinhVaBoc(input.wrapper, orgId, algorithm);
    const { rows } = await client.query<HangKhoa>(
      `INSERT INTO rfq_key_material
         (org_id, rfq_id, algorithm, public_key, wrapped_private_key, key_version,
          created_by, created_by_session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING algorithm, public_key, key_version, revoked_at`,
      [
        orgId,
        input.rfqId,
        algorithm,
        Buffer.from(publicKey),
        Buffer.from(wrapped),
        keyVersion,
        actor.id,
        actor.sessionId,
      ],
    );
    const hang = rows[0];
    if (hang === undefined) {
      throw new SealedEnvelopeError("Không ghi được vật liệu khoá cho RFQ.");
    }

    // [G4] SINH và BỌC là MỘT hành vi ở đây, nên chúng là MỘT bản ghi. Tách làm hai sự kiện sẽ
    // là một bản ghi trung thực hơn về mã và kém trung thực hơn về thế giới: giữa hai thời điểm
    // ấy không có trạng thái nào tồn tại, và không ai can thiệp vào giữa được.
    // Payload KHÔNG mang khoá công khai: nó là dữ liệu, không phải một sự kiện, và sổ kiểm toán
    // không phải chỗ nhân bản dữ liệu.
    await appendAuditEvent(client, orgId, {
      actorType: actor.type,
      actorId: actor.id,
      action: "RFQ_KEY_MATERIAL_ISSUED",
      resourceType: "rfq_key_material",
      resourceId: input.rfqId,
      payload: { algorithm, keyVersion },
    });

    ra.push(doiKhoa(hang));
  }
  return ra;
}

/**
 * Khoá CÔNG KHAI của một RFQ — thứ nhà cung cấp cần để niêm phong.
 *
 * `wrapped_private_key` không có trong câu SELECT, và nó cũng không thể có: `app_api` KHÔNG được
 * cấp quyền đọc cột ấy (017). Hai lớp nói cùng một điều, và lớp có thẩm quyền là lớp của Postgres.
 *
 * *** CẢNH BÁO CHO S1.5, GHI RA TRƯỚC KHI NÓ THÀNH MỘT LỖI ***
 *
 * Hàm này trả về CẢ khoá ĐÃ THU HỒI, kèm `revokedAt`. Đó là chủ đích — nó là một hàm BÁO TRẠNG
 * THÁI, và một hàm lặng lẽ giấu bớt hàng sẽ để người đọc tự hỏi vì sao một khoá biến mất. Nhưng
 * hệ quả là **đường nộp thầu KHÔNG được dùng thẳng kết quả này để chọn khoá niêm phong**: chọn
 * nhầm một khoá đã thu hồi là niêm phong một báo giá cho một RFQ đã chết.
 *
 * Hôm nay rủi ro ấy bị chặn bởi một tính chất KHÁC, không phải bởi hàm này: thu hồi chỉ xảy ra
 * khi RFQ đã `CANCELLED` (017 khối 4), và một RFQ đã huỷ thì không nhận báo giá. Đó là một lớp
 * THẬT, nhưng nó là lớp GIÁN TIẾP — nó đúng nhờ một ràng buộc ở chỗ khác, và ràng buộc ấy có thể
 * được nới ra ngày nào đó (xem khoản nợ 26: thu hồi vì sự cố an ninh chưa được hỗ trợ ở S1).
 *
 * Vì vậy S1.5 phải có một hàm chọn khoá RIÊNG, chỉ trả khoá còn hiệu lực. Hàm ấy **cố ý chưa tồn
 * tại**: viết nó bây giờ, khi chưa có đường nộp thầu để gọi, là dựng một lớp không ai đo được.
 */
export async function getRfqPublicKeys(
  client: pg.PoolClient,
  orgId: string,
  rfqId: string,
): Promise<readonly RfqPublicKeyRecord[]> {
  await assertTenantBound(client, orgId, "getRfqPublicKeys");
  assertRfqId(rfqId);
  const { rows } = await client.query<HangKhoa>(
    `SELECT algorithm, public_key, key_version, revoked_at
       FROM rfq_key_material WHERE rfq_id = $1 ORDER BY algorithm`,
    [rfqId],
  );
  return rows.map(doiKhoa);
}

export interface RevokeRfqKeyMaterialInput {
  readonly rfqId: string;
  readonly reason: string;
  readonly actorSessionId: string;
}

/**
 * [G4, vế "huỷ"] Thu hồi toàn bộ vật liệu khoá của một RFQ đã bị huỷ.
 *
 * Xem khối (4) của migration 017 để biết vì sao chỉ RFQ đã CANCELLED mới thu hồi được, và vì sao
 * thu hồi ở S1 là một DẤU chứ không phải một lần xoá mật mã.
 */
export async function revokeRfqKeyMaterial(
  client: pg.PoolClient,
  orgId: string,
  input: RevokeRfqKeyMaterialInput,
): Promise<number> {
  await assertTenantBound(client, orgId, "revokeRfqKeyMaterial");
  assertRfqId(input.rfqId);
  const reason = input.reason.trim();
  if (reason.length === 0 || Buffer.byteLength(reason, "utf8") > 2000) {
    throw new SealedEnvelopeError("Lý do thu hồi phải khác rỗng và không quá 2000 byte.");
  }
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  const { rows } = await client.query<{ algorithm: string }>(
    `UPDATE rfq_key_material
        SET revoked_at = now(), revoked_reason = $2,
            revoked_by = $3, revoked_by_session_id = $4
      WHERE rfq_id = $1 AND revoked_at IS NULL
      RETURNING algorithm`,
    [input.rfqId, reason, actor.id, actor.sessionId],
  );

  for (const hang of rows) {
    await appendAuditEvent(client, orgId, {
      actorType: actor.type,
      actorId: actor.id,
      action: "RFQ_KEY_MATERIAL_REVOKED",
      resourceType: "rfq_key_material",
      resourceId: input.rfqId,
      payload: { algorithm: hang.algorithm, reason },
    });
  }
  return rows.length;
}
